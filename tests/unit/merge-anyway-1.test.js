// MERGE-ANYWAY-1 (owner feedback 2026-11-11): merge-when-green never waits forever on a repository with no CI, warns when CI or
// review is missing, and can be merged past on purpose with a written reason.
import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
function call(w, name, args) {
  return createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch: w.gh.fetch, gates: [], now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db });
}

describe('merge_when_green: missing CI and review', () => {
  it('does not wait forever on a repository whose workflows never ran for the commit (no checks set up)', async () => {
    for (const waitForChecks of [false, true]) {
      const w = await makeWorld({ advanceClockOnSleep: true, profile: 'full' });
      w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
      w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'open', draft: false, merged: false, mergeable: true, mergeable_state: 'clean', head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
      w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: null, reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
      w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
      w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
      w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 0, check_runs: [] });
      w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', statuses: [] });
      w.gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200, { total_count: 1, workflows: [{ id: 1, node_id: 'W_1', name: 'manual', path: '.github/workflows/m.yml', state: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', url: 'https://api.github.com/x', html_url: 'https://github.com/x', badge_url: 'https://github.com/x' }] });
      w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-suites').reply(200, { total_count: 0, check_suites: [] });
      w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A, commit: { committer: { date: new Date(w.ctx.now() - 60 * 60000).toISOString() } } });
      const out = parse(await call(w, 'github_workflow_merge_when_green', { repo: 'hello', number: 6, expectedHeadSha: A, dryRun: true, waitForChecks }));
      expect(out.status).not.toBe('checks_running');
      expect(JSON.stringify(out)).not.toMatch(/not proven green/);
    }
  });
  it('merge_when_green stays green-only and points to the fallback; the fallback needs an acknowledgement and a real reason', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true, profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'open', draft: false, merged: false, mergeable: true, head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: 'REVIEW_REQUIRED', reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'failure', started_at: '2026-11-02T10:00:00Z', completed_at: '2026-11-02T10:01:00Z' }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'failure', statuses: [] });
    const strict = parse(await call(w, 'github_workflow_merge_when_green', { repo: 'hello', number: 6, expectedHeadSha: A, confirm: true }));
    expect(strict).toMatchObject({ status: 'not_ready', fallback_tool: 'github_workflow_merge_anyway' });
    expect(strict.warnings.length).toBeGreaterThanOrEqual(2);
    expect(strict.next).toMatch(/only merges when everything is green/);
    const ask = parse(await call(w, 'github_workflow_merge_anyway', { repo: 'hello', number: 6, expectedHeadSha: A, confirm: true }));
    expect(ask.status).toBe('needs_acknowledgement');
    expect(ask.acknowledge).toMatch(/^[0-9a-f]{8}$/);
    const lazy = parse(await call(w, 'github_workflow_merge_anyway', { repo: 'hello', number: 6, expectedHeadSha: A, confirm: true, acknowledge: ask.acknowledge, reason: 'ok fine' }));
    expect(lazy.status).toBe('needs_acknowledgement');
    const wrong = parse(await call(w, 'github_workflow_merge_anyway', { repo: 'hello', number: 6, expectedHeadSha: A, confirm: true, acknowledge: 'deadbeef', reason: 'Read the whole diff and ran tests locally' }));
    expect(wrong.status).toBe('needs_acknowledgement');
    const ok = parse(await call(w, 'github_workflow_merge_anyway', { repo: 'hello', number: 6, expectedHeadSha: A, dryRun: true, confirm: true, acknowledge: ask.acknowledge, reason: 'Read the whole diff and ran tests locally' }));
    expect(['preview', 'needs_confirmation', 'not_applied', 'merged']).toContain(ok.status);
    const hard = parse(await call(w, 'github_workflow_merge_anyway', { repo: 'hello', number: 6, expectedHeadSha: B, confirm: true }));
    expect(hard.status).toBe('not_ready');
    expect(hard.acknowledge).toBeUndefined();
  }, 120000);

  it('merges into a branch other than main (no default-branch-only blocker); the setup command turns push.negotiate off', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true, profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 7, state: 'open', draft: false, merged: false, mergeable: true, mergeable_state: 'clean', head: { ref: 'work', sha: A }, base: { ref: 'release/1', sha: B } });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: null, reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-11-02T10:00:00Z', completed_at: '2026-11-02T10:01:00Z' }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'success', statuses: [] });
    const out = parse(await call(w, 'github_workflow_merge_when_green', { repo: 'hello', number: 7, expectedHeadSha: A, dryRun: true, mergeIntoBranch: 'release/1' }));
    expect(JSON.stringify(out)).not.toMatch(/default branch/);
    expect(out.blockers ?? []).toEqual([]);
    const { setupCommand } = await import('../../src/tools/git-remote.js');
    expect(setupCommand('https://x.test', 'c', 'https://x.test/r.git')).toContain('push.negotiate false');
    expect(setupCommand('https://x.test', 'c', 'https://x.test/r.git', 'https://d.test')).toContain('push.negotiate false');
  }, 120000);
});
