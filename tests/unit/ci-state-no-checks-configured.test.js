import { describe, it, expect } from 'vitest';
import { ciState } from '../../src/github/ci-state.js';

// Owner feedback 2026-11-09: a repository with no checks at all (the library repo) could never be merged with
// "merge when green" because "no checks yet" waited forever. Only a proven zero-workflow repository is treated as
// having nothing to wait for; every uncertain case stays fail-closed.
const err = (status, message) => Object.assign(new Error(message), { status, response: { data: { message } } });
function octokit({ wfRuns = [], runs = [], statuses = [], workflows = 0, workflowsError = null, suites = [], committed = '2026-11-09T00:00:00Z' }) {
  return {
    async request(route) {
      if (route.includes('/rules/branches/')) return { data: [] };
      if (route.includes('/protection/required_status_checks')) throw err(404, 'Not Found');
      if (route === 'GET /repos/{owner}/{repo}/actions/runs') return { data: { total_count: wfRuns.length, workflow_runs: wfRuns } };
      if (route.includes('/check-runs')) return { data: { check_runs: runs, total_count: runs.length } };
      if (route.includes('/commits/{ref}/status')) return { data: { statuses } };
      if (route === 'GET /repos/{owner}/{repo}/actions/workflows') { if (workflowsError) throw workflowsError; return { data: { total_count: workflows, workflows: [] } }; }
      if (route.includes('/check-suites')) return { data: { total_count: suites.length, check_suites: suites } };
      if (route === 'GET /repos/{owner}/{repo}/commits/{ref}') return { data: { commit: { committer: { date: committed } } } };
      throw new Error('unexpected ' + route);
    }
  };
}
const NOW = Date.parse('2026-11-09T01:00:00Z');
const call = (o) => ciState(o, { owner: 'o', repo: 'r', baseBranch: 'main', headSha: 'a'.repeat(40), now: NOW });

describe('ciState: repository with no checks configured', () => {
  it('is green with its own basis and a plain note when nothing is required and there are no workflows', async () => {
    const r = await call(octokit({ workflows: 0 }));
    expect(r).toMatchObject({ green: true, known: true, basis: 'no-checks-configured', problems: [] });
    expect(r.notes.join(' ')).toMatch(/no GitHub Actions workflows/);
  });
  it('keeps waiting while the commit is brand new (a first workflow may be about to appear)', async () => {
    const r = await call(octokit({ workflows: 0, committed: new Date(NOW - 30000).toISOString() }));
    expect(r.green).toBe(false);
    expect(r.basis).toBe('all-checks');
  });
  it('keeps waiting when a check suite has started even if no workflow is listed', async () => {
    const r = await call(octokit({ workflows: 0, suites: [{ status: 'in_progress', latest_check_runs_count: 1 }] }));
    expect(r.green).toBe(false);
  });
  it('keeps waiting (not green) when workflows exist but nothing has reported yet and the commit is recent', async () => {
    const r = await call(octokit({ workflows: 2, committed: new Date(NOW - 60000).toISOString() }));
    expect(r.green).toBe(false);
    expect(r.problems[0]).toMatch(/no checks have reported/);
  });
  it('is green when workflows exist but none ran for a commit older than ten minutes (manual-only or not for pull requests)', async () => {
    const r = await call(octokit({ workflows: 2 }));
    expect(r).toMatchObject({ green: true, known: true, basis: 'no-checks-configured', no_ci_reason: 'none_ran', problems: [] });
    expect(r.notes.join(' ')).toMatch(/none of its workflows ran/);
  });
  it('is unknown-safe: an unreadable workflow list never becomes green', async () => {
    const r = await call(octokit({ workflowsError: err(403, 'Resource not accessible') }));
    expect(r.green).toBe(false);
    expect(r.basis).toBe('all-checks');
  });
  it('does not apply when a commit status exists', async () => {
    const r = await call(octokit({ statuses: [{ context: 'x', state: 'pending' }], workflows: 0 }));
    expect(r.green).toBe(false);
  });
  it('does not apply when a check run exists', async () => {
    const r = await call(octokit({ runs: [{ id: 1, name: 'ci', status: 'in_progress', started_at: '2026-11-09T00:00:00Z' }], workflows: 0 }));
    expect(r.green).toBe(false);
  });
});

describe('ciState: every check run with its duration', () => {
  it('lists all runs (not only required ones) with seconds, so a roll-up pass can be checked', async () => {
    const r = await call(octokit({ runs: [
      { id: 1, name: 'unit', status: 'completed', conclusion: 'success', started_at: '2026-11-09T00:00:00Z', completed_at: '2026-11-09T00:00:41Z', app: { slug: 'github-actions' } },
      { id: 2, name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-11-09T00:00:50Z', completed_at: '2026-11-09T00:00:53Z', app: { slug: 'github-actions' } }] }));
    expect(r.all_runs).toEqual([
      { name: 'unit', status: 'completed', conclusion: 'success', seconds: 41, app: 'github-actions' },
      { name: 'test', status: 'completed', conclusion: 'success', seconds: 3, app: 'github-actions' }]);
  });
});

describe('ciState: workflow runs that have not reported their checks yet (owner feedback 2026-11-12, PenPal #68/#69)', () => {
  const done = { id: 1, name: 'release-policy', status: 'completed', conclusion: 'success', started_at: '2026-11-09T00:00:00Z', completed_at: '2026-11-09T00:00:07Z', app: { slug: 'github-actions' } };
  it('is not green while another workflow run at the commit is still queued, even though every reported check passed', async () => {
    const r = await call(octokit({ workflows: 2, runs: [done], wfRuns: [{ id: 7, name: 'tests', status: 'queued', conclusion: null }] }));
    expect(r.green).toBe(false);
    expect(r.problems.join(' ')).toMatch(/workflow "tests": queued/);
  });
  it('is not green when a workflow run ended badly', async () => {
    const r = await call(octokit({ workflows: 2, runs: [done], wfRuns: [{ id: 7, name: 'tests', status: 'completed', conclusion: 'startup_failure' }] }));
    expect(r.green).toBe(false);
  });
  it('is green once every workflow run has completed cleanly', async () => {
    const r = await call(octokit({ workflows: 2, runs: [done], wfRuns: [{ id: 7, name: 'tests', status: 'completed', conclusion: 'success' }, { id: 8, name: 'daily', status: 'completed', conclusion: 'skipped' }] }));
    expect(r.green).toBe(true);
  });
});
