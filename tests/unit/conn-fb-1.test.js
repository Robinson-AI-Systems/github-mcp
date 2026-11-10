// CONN-FB-1: fixes from the owner's coding agent after ~20 PRs on a collaborator repository reached through an extra place
// (owner feedback 2026-11-02). Every GitHub request goes through the fake GitHub validated against the vendored schema.
import { describe, expect, it } from 'vitest';
import { assertPlaceRequest, githubFor, graphql, pinRepositoryQuery, repositoryVariables } from '../../src/github/client.js';
import { containsCredential, contentProtectionReport, credentialLocations, redact } from '../../src/github/content-protection.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { describeGithubError } from '../../src/tools/errors.js';
import { validateArgs } from '../../src/core/validate.js';
import { rateFromHeaders } from '../../src/github/rate.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const PLACE = 'collab-owner';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const T0 = 1_800_000_000_000;

async function placeWorld({ repo = 'game', changes = true, profile = 'full', mode = 'preview' } = {}) {
  const gh = makeFakeGitHub();
  let clock = T0;
  const db = createFakeDb({ clock: () => clock });
  await db.initSchema();
  await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'example-org', credentialKind: 'app', appId: 5 });
  await db.upsertExtraPlace({ login: PLACE, accountId: 77, accountType: 'User', repo });
  if (changes) await db.setPlaceChanges(PLACE, true);
  const connection = { client_id: 'pcl_x', default_account: 'example-org', accounts: ['example-org', PLACE], mode, profile, listing: 'compact' };
  const credentials = { token: async (r) => (r.cred === 'M' ? 'ghp_FAKEmaster' : 'ghs_FAKEinstall') };
  const ctx = { db, fetch: gh.fetch, now: () => clock, retryAfterBaseValue: 1, sleep: async (ms) => { clock += ms; }, connection, credentials };
  const dispatch = createDispatch({ credentials, fetch: gh.fetch, gates: [], now: () => clock, sleep: ctx.sleep });
  const call = (name, args) => dispatch({ registry, name, args, connection, db });
  return { gh, db, ctx, call };
}

describe('item 2: lockfiles are not credentials, real credentials still are', () => {
  const lock = JSON.stringify({ name: 'game', lockfileVersion: 3, packages: {
    '': { dependencies: { pg: '^8.13.1' } },
    'node_modules/pg': { version: '8.13.1', resolved: 'https://registry.npmjs.org/pg/-/pg-8.13.1.tgz', integrity: 'sha512-OUir1A0rPNZlX//c7ksiu7crsGZTKSOXJPgtNiHGIlC9H0lO+NC6ZDYksSgBYY/thSWhnSRBv8w1lieyJjqRgQ==', dependencies: { 'pg-pool': '^3.7.0', pgpass: '1.x' } },
    'node_modules/pgpass': { version: '1.0.5', resolved: 'https://registry.npmjs.org/pgpass/-/pgpass-1.0.5.tgz', integrity: 'sha512-FdW9r/jQZhSeohs1Z3sI1yxFQNFvMcnmfuj4Oi4+CsoctkQ4Wv3eC8fnIzEQj2uRhA28S4P2LeIhwOkmM6yYjSug==' },
    'node_modules/stripe': { version: '17.4.0', integrity: 'sha512-sQQGZd9kGzh7g3/ea3u3LLYjBQGeEBOVf2nJ/AAFgCFHIUvOyz/wDf5bTyAzt3hRL9nb3YkfVx+jqkTJ7ln+Q==' }
  } }, null, 2);
  it('accepts package-lock, pnpm and yarn dependency entries, including the pgpass package', () => {
    for (const text of [lock, 'packages:\n  pgpass@1.0.5:\n    resolution: {integrity: sha512-FdW9r/jQZhSeohs1Z3sI1yxFQNFvMcnmfuj4Oi4+CsoctkQ4Wv3eC8fnIzEQj2uRhA28S4P2LeIhwOkmM6yYjSug==}\n    dependencies:\n      pgpass: 1.0.5\n',
      'pgpass@1.x:\n  version "1.0.5"\n  resolved "https://registry.yarnpkg.com/pgpass/-/pgpass-1.0.5.tgz"\n', '{"dependencies":{"pgpass":"^1.0.5","pg_pass":"~2.1.0"}}']) {
      expect(containsCredential(text)).toBe(false);
      expect(redact(text)).toBe(text);
      expect(contentProtectionReport(text).total_findings).toBe(0);
    }
    // Random integrity hashes never look like a provider token either.
    for (let i = 0; i < 2000; i++) {
      const hash = `sha512-${Buffer.from(Array.from({ length: 64 }, (_, j) => (i * 131 + j * 17 + (i ^ j)) & 255)).toString('base64')}`;
      expect(containsCredential(`"integrity": "${hash}"`)).toBe(false);
    }
  });
  it('still finds database passwords, including ones assigned to the same key names', () => {
    for (const text of ['DB_PASSWORD=FAKE_DATABASE_ONLY_12345', 'pgpass = "FAKE_DATABASE_ONLY_12345"', '{"pg_pass":"FAKE_DATABASE_ONLY_12345"}', 'postgresql' + '://u:FAKE_DATABASE_ONLY_12345@example.invalid/db',
      `${lock}\n// "resolved": "https://u:FAKE_DATABASE_ONLY_12345@example.invalid"\n"github_token": "ghp_FAKE0123456789abcdefghijABCDEFGHIJ"`]) {
      expect(containsCredential(text)).toBe(true);
    }
  });
  it('names the line and rule of a match without the value', () => {
    const text = 'line one\nconst DATABASE_PASSWORD = "FAKE_DATABASE_ONLY_12345";\n';
    const where = credentialLocations(text);
    expect(where).toBe('line 2 (database-password-assignment)');
    expect(where).not.toContain('FAKE_DATABASE');
  });
});

describe('items 3 and 4: a place limited to named repositories', () => {
  const THREADS = pinRepositoryQuery('query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }', repositoryVariables('name'));
  it('runs this server\'s pinned GraphQL documents for its listed repository only', async () => {
    const { gh, ctx } = await placeWorld();
    gh.when('POST /graphql').reply(200, { data: { repository: { id: 'R_1' } } });
    const octokit = await githubFor(ctx, { owner: PLACE });
    expect(await graphql(octokit, THREADS, { owner: PLACE, name: 'Game' })).toEqual({ repository: { id: 'R_1' } });
    await expect(graphql(octokit, THREADS, { owner: PLACE, name: 'secret' })).rejects.toMatchObject({ code: 'outside_scope', message: expect.stringMatching(/not one of the places you added/) });
    await expect(graphql(octokit, THREADS, { owner: 'someone-else', name: 'game' })).rejects.toMatchObject({ code: 'outside_scope' });
    // Any other document (the universal GraphQL tool, a viewer query) is still refused, in words that say why.
    await expect(graphql(octokit, 'query { viewer { login } }')).rejects.toMatchObject({ code: 'outside_scope', message: expect.stringMatching(/cannot be tied to one of them/) });
    expect(gh.graphql).toHaveLength(1);
    expect(gh.invalid).toEqual([]);
  });
  it('a pinned commit names its repository by name only; a node id or an unlisted repository is refused before sending', () => {
    const place = { allow_changes: true, allowed_repos: ['game'] };
    const COMMIT = 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }';
    const input = (branch) => ({ input: { branch, message: { headline: 'x' }, expectedHeadOid: A, fileChanges: {} } });
    expect(() => assertPlaceRequest(place, PLACE, 'POST', '/graphql', true, { query: COMMIT, variables: input({ repositoryNameWithOwner: `${PLACE}/game`, branchName: 'work' }) })).not.toThrow();
    expect(() => assertPlaceRequest(place, PLACE, 'POST', '/graphql', true, { query: COMMIT, variables: input({ id: 'REF_other', repositoryNameWithOwner: `${PLACE}/game`, branchName: 'work' }) })).toThrow(/not one of the places/);
    expect(() => assertPlaceRequest(place, PLACE, 'POST', '/graphql', true, { query: COMMIT, variables: input({ repositoryNameWithOwner: `${PLACE}/other`, branchName: 'work' }) })).toThrow(/not one of the places/);
    expect(() => assertPlaceRequest({ ...place, allow_changes: false }, PLACE, 'POST', '/graphql', true, { query: COMMIT, variables: input({ repositoryNameWithOwner: `${PLACE}/game`, branchName: 'work' }) })).toThrow(/Changes are off/);
    expect(() => pinRepositoryQuery('query($id: ID!) { node(id: $id) { id } }', repositoryVariables())).toThrow(/only select through its one repository/);
  });
  it('github_pr_get verifies review threads there (it used to report them unreadable)', async () => {
    const { gh, call } = await placeWorld();
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'open', draft: false, merged: false, head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B }, mergeable: true, mergeable_state: 'clean', html_url: 'https://github.com/x/y/pull/6' });
    gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: null, reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-11-02T10:00:00Z' }] });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'success', statuses: [] });
    const out = parse(await call('github_pr_get', { owner: PLACE, repo: 'game', number: 6 }));
    expect(out.threads).toEqual({ total: 0, unresolved: 0 });
    expect(out.checks.green).toBe(true);
    expect(gh.invalid).toEqual([]);
  });
  it('unreadable threads are never treated as none, and the reason is given', async () => {
    const { gh, call } = await placeWorld();
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'closed', draft: false, merged: true, head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
    gh.when('POST /graphql').reply(502, { message: 'Bad Gateway' });
    const out = parse(await call('github_pr_get', { owner: PLACE, repo: 'game', number: 6 }));
    expect(out.threads.unresolved).toBeUndefined();
    expect(out.threads.unknown).toMatch(/could not be read: GitHub answered HTTP 502/);
  });
  it('github_content_push_files commits there, checking the branch rules the REST path checks', async () => {
    const { gh, call } = await placeWorld();
    gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'game' });
    // The branch moves to the new commit once the commit has been sent.
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, () => ({ protected: false, commit: { sha: gh.graphql.length ? B : A } }));
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'https://github.com/x/y/commit/b' } } } });
    const args = { owner: PLACE, repo: 'game', branch: 'work', message: 'Add lockfile', files: [{ path: 'package-lock.json', content: '{"packages":{"node_modules/pgpass":{"version":"1.0.5"}}}' }] };
    const out = parse(await call('github_content_push_files', { ...args, confirm: true }));
    expect(out.status).toBe('applied');
    expect(gh.graphql).toHaveLength(1);
    expect(gh.graphql[0].variables.input.branch).toEqual({ repositoryNameWithOwner: `${PLACE}/game`, branchName: 'work' });
    expect(gh.invalid).toEqual([]);
  });
  it('a branch with rules on the place is refused for the master token, as for REST (a non-owner connection)', async () => {
    const { gh, call } = await placeWorld({ profile: 'everyday', mode: 'production' });
    gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'game' });
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: true, commit: { sha: A } });
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'u' } } } });
    const out = parse(await call('github_content_push_files', { owner: PLACE, repo: 'game', branch: 'work', message: 'x', files: [{ path: 'a.txt', content: 'x' }], confirm: true }));
    expect(out.status).not.toBe('applied');
    expect(JSON.stringify(out)).toMatch(/Branch rules apply to work/);
    expect(gh.graphql).toHaveLength(0);
  });
});

describe('item 1: github_check_wait', () => {
  const routes = (gh, runs) => {
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'open', head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, [{ type: 'required_status_checks', ruleset_id: 1, parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'ci' }, { context: 'release-policy' }] } }]);
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').replySequence(runs.map((list) => ({ status: 200, body: { total_count: list.length, check_runs: list } })));
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', statuses: [] });
  };
  const run = (name, status, conclusion = null, id = 1) => ({ id, name, status, conclusion, started_at: '2026-11-02T10:00:00Z' });
  it('returns as soon as every required check is green', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    routes(w.gh, [[], [run('ci', 'in_progress')], [run('ci', 'completed', 'success'), run('release-policy', 'completed', 'success', 2)]]);
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 6 }));
    expect(out).toMatchObject({ status: 'finished', done: true, overall: 'green', head_sha: A, polls: 3, waited_seconds: 12 });
    expect(out.resume).toBeUndefined();
    expect(w.gh.invalid).toEqual([]);
  });
  it('stops early on a red required check even while another is running', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    routes(w.gh, [[run('ci', 'completed', 'failure'), run('release-policy', 'in_progress', null, 2)]]);
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 6 }));
    expect(out).toMatchObject({ status: 'finished', overall: 'red', polls: 1, still_running: ['release-policy'] });
    expect(out.next).toMatch(/github_actions_get_run_logs_summary/);
  });
  it('ends within its time with a resumable still_running answer', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    routes(w.gh, Array.from({ length: 10 }, () => [run('ci', 'in_progress')]));
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 6, timeoutSeconds: 15 }));
    expect(out).toMatchObject({ status: 'still_running', done: false, overall: 'pending', still_running: ['ci'], not_reported_yet: ['release-policy'] });
    expect(out.waited_seconds).toBeLessThanOrEqual(15);
    expect(out.resume).toEqual({ tool: 'github_check_wait', arguments: { repo: 'hello', pr: 6, expectedHeadSha: A } });
  });
  it('says when the head moved, and that CI usually starts within a minute', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    routes(w.gh, [[], []]);
    expect(parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 6, expectedHeadSha: B }))).toMatchObject({ status: 'head_moved', head_sha: A });
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 6, timeoutSeconds: 5 }));
    expect(out.next).toMatch(/CI usually starts within a minute/);
  });
  it('needs exactly one of pr or ref', async () => {
    const w = await makeWorld();
    expect((await call(w, 'github_check_wait', { repo: 'hello' })).content[0].text).toMatch(/exactly one of pr/);
  });
  // Live-found 2026-11-02: a repository with no CI at all answered still_running forever.
  const suiteOf = (i) => ({ id: 100 + i, node_id: 'CS_' + i, head_branch: 'work', head_sha: A, status: 'queued', conclusion: null, url: 'https://api.github.com/x', before: null, after: null, pull_requests: [], app: null, repository: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', head_commit: null, latest_check_runs_count: 0, check_runs_url: 'https://api.github.com/x' });
  const noCi = (gh, { workflows = 0, suites = 0, emptyQueued = 0, committed }) => {
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 1, state: 'open', head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 0, check_runs: [] });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', statuses: [] });
    gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200, { total_count: workflows, workflows: workflows ? [{ id: 1, node_id: 'W_1', name: 'ci', path: '.github/workflows/ci.yml', state: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', url: 'https://api.github.com/x', html_url: 'https://github.com/x', badge_url: 'https://github.com/x' }] : [] });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-suites').reply(200, { total_count: suites + emptyQueued, check_suites: Array.from({ length: emptyQueued }, (_, i) => suiteOf(i)) });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A, commit: { committer: { date: committed } } });
  };
  it('answers no_ci at once for a repository with no workflows, check suites or required checks', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    noCi(w.gh, { committed: new Date(w.ctx.now() - 600000).toISOString() });
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 1 }));
    expect(out).toMatchObject({ status: 'no_ci', done: true, overall: 'no_ci', head_sha: A, polls: 1 });
    expect(out.next).toMatch(/runs no automated checks/); expect(out.resume).toBeUndefined();
    expect(w.gh.invalid).toEqual([]);
  });
  it('says none are coming when workflows exist but none ran on a commit older than 10 minutes', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    noCi(w.gh, { workflows: 1, committed: new Date(w.ctx.now() - 11 * 60000).toISOString() });
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 1 }));
    expect(out).toMatchObject({ status: 'no_ci', done: true, reason: 'none_ran', polls: 1 });
    expect(out.next).toMatch(/do not run for it/);
    expect(w.gh.invalid).toEqual([]);
  });
  it('ignores the empty queued suites GitHub creates for installed apps', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    noCi(w.gh, { workflows: 3, emptyQueued: 2, committed: new Date(w.ctx.now() - 60 * 60000).toISOString() });
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 1 }));
    expect(out).toMatchObject({ status: 'no_ci', reason: 'none_ran' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('never says none are coming while a required check is still missing', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    noCi(w.gh, { workflows: 1, committed: new Date(w.ctx.now() - 60 * 60000).toISOString() });
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(200, { url: 'https://api.github.com/x', strict: false, contexts: ['ci'], contexts_url: 'https://api.github.com/x', checks: [{ context: 'ci', app_id: null }] });
    const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 1, timeoutSeconds: 5 }));
    expect(out.status).not.toBe('no_ci');
    expect(w.gh.invalid).toEqual([]);
  });
  it('keeps waiting while the commit is new (with or without workflows)', async () => {
    for (const shape of [{ workflows: 0, ageMs: 30000 }, { workflows: 1, ageMs: 5 * 60000 }]) {
      const w = await makeWorld({ advanceClockOnSleep: true });
      noCi(w.gh, { workflows: shape.workflows, committed: new Date(w.ctx.now() - shape.ageMs).toISOString() });
      const out = parse(await call(w, 'github_check_wait', { repo: 'hello', pr: 1, timeoutSeconds: 5 }));
      expect(out).toMatchObject({ status: 'still_running', done: false });
      expect(w.gh.invalid).toEqual([]);
    }
  });
});

describe('merge_when_green: waitForChecks and the stack sibling message', () => {
  it('waits only on running checks and never merges while they run', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true, profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'open', draft: false, merged: false, mergeable: true, head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: null, reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'in_progress', conclusion: null, started_at: '2026-11-02T10:00:00Z' }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', statuses: [] });
    const out = parse(await call(w, 'github_workflow_merge_when_green', { repo: 'hello', number: 6, expectedHeadSha: A, waitForChecks: true, confirm: true }));
    expect(out).toMatchObject({ status: 'checks_running', done: false, checks: 'pending', still_running: ['ci'] });
    expect(out.next).toMatch(/waitForChecks: true/);
    expect(w.gh.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(w.gh.invalid).toEqual([]);
  });
  it('without waitForChecks, checks that are still running are "checks_running", not a fault to repair', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true, profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'open', draft: false, merged: false, mergeable: true, head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: null, reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'in_progress', conclusion: null, started_at: '2026-11-02T10:00:00Z' }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', statuses: [] });
    const out = parse(await call(w, 'github_workflow_merge_when_green', { repo: 'hello', number: 6, expectedHeadSha: A, confirm: true }));
    expect(out).toMatchObject({ status: 'checks_running', done: false });
    expect(out.next).toMatch(/Nothing needs repairing/);
    expect(w.gh.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
  it('explains a sibling PR in a stack list instead of only "chain is broken"', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([
      { status: 200, body: { number: 6, state: 'open', draft: false, merged: false, head: { ref: 'one', sha: A }, base: { ref: 'main', sha: B } } },
      { status: 200, body: { number: 11, state: 'open', draft: false, merged: false, head: { ref: 'two', sha: B }, base: { ref: 'main', sha: B } } }]);
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: null, reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 0, check_runs: [] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', statuses: [] });
    const out = parse(await call(w, 'github_workflow_merge_stack', { repo: 'hello', prs: [6, 11] }));
    expect(out.reason).toMatch(/#11 is a sibling of PR #6 \(both are based on main\)/);
  });
});

describe('item 5: meta.github_rate lists only the acting account', () => {
  const NOW = Date.UTC(2026, 10, 2, 20);
  const head = { 'x-ratelimit-remaining': '4000', 'x-ratelimit-reset': String(Math.floor((NOW + 60000) / 1000)), 'x-ratelimit-resource': 'core' };
  const reg = { tools: [{ name: 'github_testing_read', area: 'test', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { owner: { type: 'string' } }, additionalProperties: false } }],
    handlers: { github_testing_read: async (_a, ctx) => {
      // What the people guard does on a PR create: it reads members of every connected organization.
      for (const account of [PLACE, 'example-org', 'example-scratch']) ctx.rateObservations.record({ account, credential: account === PLACE ? 'god_mode' : 'app', resource: 'core', observation: rateFromHeaders(head, { now: () => NOW }) });
      ctx.rateObservations.record({ account: 'blocked-org', credential: 'app', resource: 'search', source: 'cached', observation: { resource: 'search', remaining: 0, blockedUntil: new Date(NOW + 30000) } });
      return { ok: true };
    } } };
  it('keeps the acting account, and another only when it is blocked', async () => {
    const dispatch = createDispatch({ now: () => NOW });
    const connection = { client_id: 'c', accounts: ['example-org', PLACE, 'example-scratch', 'blocked-org'], default_account: 'example-org', mode: 'preview', profile: 'read_only' };
    const r = await dispatch({ registry: reg, name: 'github_testing_read', args: { owner: PLACE }, connection, db: {} });
    expect(r.structuredContent.meta.github_rate.items.map((x) => x.account)).toEqual([PLACE, 'blocked-org']);
    const d = await dispatch({ registry: reg, name: 'github_testing_read', args: {}, connection, db: {} });
    expect(d.structuredContent.meta.github_rate.items.map((x) => x.account)).toEqual(['example-org', 'blocked-org']);
  });
});

describe('items 7, 12 and 14: missing branches and wrong-shape arguments', () => {
  it('a commit list on a missing branch says the branch does not exist', () => {
    const error = Object.assign(new Error('No commit found for SHA: nope'), { status: 404, response: { data: { message: 'No commit found for SHA: nope' } }, request: { url: 'https://api.github.com/repos/o/r/commits?per_page=30&sha=nope' } });
    const x = describeGithubError(error, { account: 'o' });
    expect(x.kind).toBe('ref_not_found');
    expect(x.what).toContain('"nope"');
    // A missing commit SHA on its own commit URL keeps the not-found wording.
    expect(describeGithubError(Object.assign(new Error('Not Found'), { status: 404, response: { data: { message: 'Not Found' } }, request: { url: 'https://api.github.com/repos/o/r/commits/abc' } })).kind).toBe('not_found');
  });
  it('github_commit_list, github_pr_create and github_content_push_files say a missing branch is missing', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/commits').reply(404, { message: 'No commit found for SHA: gone' });
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(404, { message: 'Branch not found' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(404, { message: 'Not Found' });
    const listed = await call(w, 'github_commit_list', { repo: 'hello', ref: 'gone' });
    expect(listed.content[0].text).toMatch(/branch or ref "gone" does not exist/);
    expect(listed.content[0].text).not.toMatch(/cannot see it/);
    const pr = await call(w, 'github_pr_create', { repo: 'hello', head: 'gone', title: 'x', confirm: true });
    expect(JSON.stringify(parse(pr))).toMatch(/gone does not exist|There is no branch gone/);
    const push = await call(w, 'github_content_push_files', { repo: 'hello', branch: 'gone', message: 'x', files: [{ path: 'a', content: 'x' }], confirm: true });
    expect(JSON.stringify(parse(push))).toMatch(/gone does not exist/);
    expect(JSON.stringify(parse(push))).not.toMatch(/cannot see it/);
  });
  it('an unknown argument lists the valid ones', () => {
    const schema = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, runId: { type: 'integer' } }, additionalProperties: false };
    expect(validateArgs(schema, { repo: 'x', bogus: 1 })).toBe('Unknown argument: bogus. Valid arguments: owner, repo, runId.');
    expect(validateArgs({ type: 'object', properties: { options: { type: 'object', properties: { paths: { type: 'array' } }, additionalProperties: false } } }, { options: { files: [] } }))
      .toBe('Unknown argument in options: files. Valid arguments in options: paths.');
  });
});

describe('items 6, 15, 17-20: results with the essentials', () => {
  it('github_workflow_open_pr without confirm is a plain preview, not an uncertain write', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { ref: 'refs/heads/work', object: { sha: A } });
    const out = parse(await call(w, 'github_workflow_open_pr', { repo: 'hello', head: 'work', title: 'Add things' }));
    expect(out.status).toBe('preview');
    expect(out.next).toMatch(/Nothing was sent.*confirm: true/);
    expect(JSON.stringify(out)).not.toMatch(/uncertain/);
  });
  it('an opened PR reports number, URL, head/base, head SHA, state, draft and mergeability', async () => {
    const w = await makeWorld({ profile: 'full' });
    const pr = { number: 12, title: 'Add things', state: 'open', draft: false, merged: false, head: { ref: 'work', sha: A, repo: { full_name: 'example-org/hello' } }, base: { ref: 'main', sha: B }, mergeable: null, mergeable_state: 'unknown', html_url: 'https://github.com/example-org/hello/pull/12' };
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { ref: 'refs/heads/work', object: { sha: A } });
    w.gh.when('POST /repos/{owner}/{repo}/pulls').reply(201, pr);
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, pr);
    const out = parse(await call(w, 'github_workflow_open_pr', { repo: 'hello', head: 'work', title: 'Add things', confirm: true }));
    expect(out).toMatchObject({ done: true, status: 'pr_opened', number: 12, html_url: pr.html_url, state: 'open', draft: false, head: 'work', head_sha: A, base: 'main', mergeable_state: 'unknown' });
    expect(out.next).toMatch(/github_check_wait/);
    expect(JSON.stringify(out).length).toBeLessThan(8192);
  });
  it('github_pr_list says whether a closed PR was merged', async () => {
    const w = await makeWorld();
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, [
      { number: 3, state: 'closed', merged_at: '2026-11-02T10:00:00Z', head: { ref: 'a', sha: A }, base: { ref: 'main' } },
      { number: 4, state: 'closed', merged_at: null, head: { ref: 'b', sha: B }, base: { ref: 'main' } }]);
    const out = parse(await call(w, 'github_pr_list', { repo: 'hello', state: 'closed' }));
    expect(out.items.map((p) => [p.number, p.merged])).toEqual([[3, true], [4, false]]);
  });
  it('github_content_get reads from startLine alone and points folders at the recursive tree', async () => {
    const w = await makeWorld();
    const text = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n');
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, (request) => (String(request.path ?? request.params?.path ?? '').includes('a.txt')
      ? { type: 'file', path: 'a.txt', sha: 'c'.repeat(40), size: text.length, encoding: 'base64', content: Buffer.from(text).toString('base64') }
      : [{ name: 'src', path: 'src', type: 'dir', size: 0 }, { name: 'a.txt', path: 'a.txt', type: 'file', size: 10 }]));
    const lines = parse(await call(w, 'github_content_get', { repo: 'hello', path: 'a.txt', startLine: 50 }));
    expect(lines).toMatchObject({ start_line: 50, end_line: 249, next_start_line: 250 });
    const dir = parse(await call(w, 'github_content_get', { repo: 'hello', path: 'src' }));
    expect(dir.items[0]).not.toHaveProperty('size');
    expect(dir.tree.tool).toBe('github_content_get_tree');
  });
  it('github_batch says how to get a whole file instead of cutting it', async () => {
    const w = await makeWorld();
    const text = 'x'.repeat(9000);
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, { type: 'file', path: 'big.txt', sha: 'c'.repeat(40), size: text.length, encoding: 'base64', content: Buffer.from(text).toString('base64') });
    const out = parse(await call(w, 'github_batch', { calls: [{ name: 'github_content_get', args: { repo: 'hello', path: 'big.txt', fullText: true } }] }));
    expect(out.results[0]).toMatchObject({ ok: true, omitted: 'too_large_for_batch', call_alone: { name: 'github_content_get', args: { repo: 'hello', path: 'big.txt', fullText: true } } });
    expect(out.note).toMatch(/github_get_result/);
  });
  it('the run log summary accepts pr or ref and shows the lines before a bare "exit code 1"', async () => {
    const w = await makeWorld();
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, head: { ref: 'work', sha: A }, base: { ref: 'main' } });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs').reply(200, { total_count: 1, workflow_runs: [{ id: 55, name: 'ci', status: 'completed', conclusion: 'failure', head_sha: A }] });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs').reply(200, { total_count: 1, jobs: [{ id: 9, name: 'test', status: 'completed', conclusion: 'failure', steps: [{ number: 3, name: 'Run tests', conclusion: 'failure' }] }] });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs').reply(404, { message: 'Not Found' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200, '2026-11-02T10:00:00.000Z > node scripts/check.mjs\n2026-11-02T10:00:01.000Z docs drift: TOOL-CATALOG.md lacks github_x\n2026-11-02T10:00:02.000Z ##[error]Process completed with exit code 1.\n');
    const out = parse(await call(w, 'github_actions_get_run_logs_summary', { repo: 'hello', pr: 6 }));
    expect(out).toMatchObject({ run_id: 55, head_sha: A });
    expect(out.failed_jobs[0].lines_before_failure.join('\n')).toMatch(/docs drift: TOOL-CATALOG.md lacks github_x/);
    expect((await call(w, 'github_actions_get_run_logs_summary', { repo: 'hello', runId: 55, ref: 'work' })).content[0].text).toMatch(/exactly one of runId/);
    expect(w.gh.invalid).toEqual([]);
  });
  it('a job log window takes its own response field names back and hands over the next call', async () => {
    const w = await makeWorld();
    const log = Array.from({ length: 400 }, (_, i) => `step output line ${i}`).join('\n');
    w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}').reply(200, { id: 9, name: 'test' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200, log);
    const first = parse(await call(w, 'github_actions_get_job_log', { repo: 'hello', jobId: 9, fullText: true }));
    expect(first.continue.arguments).toMatchObject({ jobId: 9, fullText: true, textOffset: first.next_text_offset, expectedLogHash: first.log_hash });
    const second = parse(await call(w, 'github_actions_get_job_log', { repo: 'hello', jobId: 9, fullText: true, text_offset: first.next_text_offset, log_hash: first.log_hash }));
    expect(second.text_offset).toBe(first.next_text_offset);
  });
});

function call(w, name, args) {
  return createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch: w.gh.fetch, gates: [], now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db });
}
